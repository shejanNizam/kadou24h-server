import { Order } from "../order/order.model";
import { SubOrder } from "../order/sub_order.model";
import { OrderStatus, SettlementStatus, SubOrderStatus } from "../order/order.interface";
import { ApprovalStatus } from "../profile_common/profile.common";
import { Report } from "../report/report.model";
import { ReportStatus } from "../report/report.interface";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { SupportTicket } from "../support_ticket/support_ticket.model";
import { TicketStatus, TicketUrgency } from "../support_ticket/support_ticket.interface";
import { ADMIN_ROLES, UserStatus } from "../user/user.interface";
import { User } from "../user/user.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { Withdrawal } from "../wallet/withdrawal.model";
import { WithdrawalStatus } from "../wallet/wallet.interface";

// $sum helper: the field value for orders that are not cancelled, else 0
// App users only — admin/staff accounts are managed in Settings, like the Users page
const appUsers = { isDeleted: false, roles: { $nin: ADMIN_ROLES } };

const notCancelled = (field: string) => ({
  $cond: [{ $eq: ["$status", OrderStatus.cancelled] }, 0, field],
});

// Commission counts as earned only once the vendor earning is released
const earnedCommission = {
  $cond: [{ $eq: ["$settlement", SettlementStatus.released] }, "$commissionAmount", 0],
};

/** Not sales: cancelled, and online orders still waiting for their payment. */
const NOT_SALES = [SubOrderStatus.cancelled, SubOrderStatus.pending_payment];

/** Per-period GMV and earned commission from non-cancelled sub-orders. */
const subOrderSeries = (format: string, since: Date) =>
  SubOrder.aggregate<{ _id: string; gmv: number; commission: number }>([
    { $match: { createdAt: { $gte: since }, status: { $nin: NOT_SALES } } },
    {
      $group: {
        _id: { $dateToString: { format, date: "$createdAt" } },
        gmv: { $sum: "$total" },
        commission: { $sum: earnedCommission },
      },
    },
  ]);

/** Chart point = revenue (platform fee + commission) and GMV (sub-orders + platform fee). */
const mergeSeries = (
  target: Map<string, { platformFee: number; gmv: number }>,
  orderAgg: { _id: string; totalPlatformFees: number }[],
  subOrderAgg: { _id: string; gmv: number; commission: number }[],
) => {
  const fees = new Map(orderAgg.map((o) => [o._id, o.totalPlatformFees || 0]));
  const keys = new Set([...fees.keys(), ...subOrderAgg.map((s) => s._id)]);
  for (const key of keys) {
    const sub = subOrderAgg.find((s) => s._id === key);
    const fee = fees.get(key) ?? 0;
    target.set(key, { platformFee: fee + (sub?.commission ?? 0), gmv: (sub?.gmv ?? 0) + fee });
  }
};

const getPlatformOverview = async () => {
  const now = new Date();

  // 1. Date boundaries for current week starting from Saturday to Friday
  const daysSinceSaturday = (now.getDay() + 1) % 7;
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - daysSinceSaturday);
  startOfWeek.setHours(0, 0, 0, 0);

  // 2. Date boundaries for calendar year (Jan to Dec)
  const currentYear = now.getFullYear();
  const startOfYear = new Date(currentYear, 0, 1);
  startOfYear.setHours(0, 0, 0, 0);

  const [
    totalUsers,
    totalVendors,
    totalRiders,
    suspendedUsers,
    ordersCount,
    ordersAgg,
    subOrdersAgg,
    pendingWithdrawals,
    openTickets,
    criticalTickets,
    pendingReports,
    pendingVendorApprovals,
    pendingRiderApprovals,
    weeklyRevenueAgg,
    monthlyRevenueAgg,
    usersGrowthAgg,
    vendorsGrowthAgg,
    subOrderMoneyAgg,
    weeklySubOrderAgg,
    monthlySubOrderAgg,
  ] = await Promise.all([
    User.countDocuments(appUsers),
    VendorProfile.countDocuments({ approvalStatus: ApprovalStatus.approved }),
    RiderProfile.countDocuments({ approvalStatus: ApprovalStatus.approved }),
    User.countDocuments({ ...appUsers, status: UserStatus.suspended }),
    Order.countDocuments(),

    Order.aggregate([
      {
        $group: {
          _id: null,
          totalPlatformFees: { $sum: notCancelled("$platformFee") },
          completedOrders: {
            $sum: { $cond: [{ $eq: ["$status", OrderStatus.completed] }, 1, 0] },
          },
          activeOrders: {
            $sum: { $cond: [{ $eq: ["$status", OrderStatus.active] }, 1, 0] },
          },
          cancelledOrders: {
            $sum: { $cond: [{ $eq: ["$status", OrderStatus.cancelled] }, 1, 0] },
          },
        },
      },
    ]),

    SubOrder.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]),

    Withdrawal.aggregate([
      { $match: { status: WithdrawalStatus.pending } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]),

    SupportTicket.countDocuments({ status: { $in: [TicketStatus.open, TicketStatus.in_progress] } }),
    SupportTicket.countDocuments({
      status: { $in: [TicketStatus.open, TicketStatus.in_progress] },
      urgency: TicketUrgency.critical,
    }),
    Report.countDocuments({ status: ReportStatus.pending }),
    VendorProfile.countDocuments({ approvalStatus: ApprovalStatus.pending }),
    RiderProfile.countDocuments({ approvalStatus: ApprovalStatus.pending }),

    // Current week revenue aggregation (Saturday to Friday)
    Order.aggregate([
      { $match: { createdAt: { $gte: startOfWeek }, status: { $ne: OrderStatus.cancelled } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          totalPlatformFees: { $sum: "$platformFee" },
        },
      },
    ]),

    // Calendar year revenue aggregation (Jan to Dec)
    Order.aggregate([
      { $match: { createdAt: { $gte: startOfYear }, status: { $ne: OrderStatus.cancelled } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          totalPlatformFees: { $sum: "$platformFee" },
        },
      },
    ]),

    // Monthly user registrations for current year
    User.aggregate([
      { $match: { ...appUsers, createdAt: { $gte: startOfYear } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
    ]),

    // Monthly vendor registrations for current year
    VendorProfile.aggregate([
      { $match: { createdAt: { $gte: startOfYear } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
    ]),

    // GMV (non-cancelled sub-orders) and commission actually earned (released)
    SubOrder.aggregate([
      { $match: { status: { $nin: NOT_SALES } } },
      { $group: { _id: null, gmv: { $sum: "$total" }, commission: { $sum: earnedCommission } } },
    ]),
    subOrderSeries("%Y-%m-%d", startOfWeek),
    subOrderSeries("%Y-%m", startOfYear),
  ]);

  const subOrderMoney = subOrderMoneyAgg[0] || { gmv: 0, commission: 0 };
  const orderStats = ordersAgg[0] || {
    totalPlatformFees: 0,
    completedOrders: 0,
    activeOrders: 0,
    cancelledOrders: 0,
  };

  const withdrawalStats = pendingWithdrawals[0] || {
    count: 0,
    totalAmount: 0,
  };

  // Map sub-orders breakdown
  const subOrderMap = new Map<string, number>();
  subOrdersAgg.forEach((item: { _id: string; count: number }) => {
    subOrderMap.set(item._id, item.count);
  });

  const completed = orderStats.completedOrders || subOrderMap.get(SubOrderStatus.delivered) || 0;
  const inTransit = subOrderMap.get(SubOrderStatus.in_delivery) || 0;
  const pending = subOrderMap.get(SubOrderStatus.new) || 0;
  const inProgress =
    (subOrderMap.get(SubOrderStatus.accepted) || 0) +
    (subOrderMap.get(SubOrderStatus.preparing) || 0) +
    (subOrderMap.get(SubOrderStatus.ready_for_pickup) || 0);
  const cancelled = orderStats.cancelledOrders || subOrderMap.get(SubOrderStatus.cancelled) || 0;
  const reported = pendingReports || 0;

  // Build weekly revenue series (Saturday to Friday of current week)
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weeklyRevenueMap = new Map<string, { platformFee: number; gmv: number }>();
  mergeSeries(weeklyRevenueMap, weeklyRevenueAgg, weeklySubOrderAgg);

  const weeklyRevenueData: Array<{ day: string; date: string; value: number; gmv: number }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    d.setHours(12, 0, 0, 0);
    const dateStr = d.toISOString().split("T")[0];
    const dayName = dayNames[d.getDay()];
    const stats = weeklyRevenueMap.get(dateStr) || { platformFee: 0, gmv: 0 };
    weeklyRevenueData.push({
      day: dayName,
      date: dateStr,
      value: stats.platformFee,
      gmv: stats.gmv,
    });
  }

  // Build monthly growth and revenue series for the full calendar year (Jan to Dec)
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const userGrowthMap = new Map<string, number>();
  usersGrowthAgg.forEach((item: { _id: string; count: number }) => {
    userGrowthMap.set(item._id, item.count);
  });

  const vendorGrowthMap = new Map<string, number>();
  vendorsGrowthAgg.forEach((item: { _id: string; count: number }) => {
    vendorGrowthMap.set(item._id, item.count);
  });

  const monthlyRevenueMap = new Map<string, { platformFee: number; gmv: number }>();
  mergeSeries(monthlyRevenueMap, monthlyRevenueAgg, monthlySubOrderAgg);

  const platformGrowth: Array<{ month: string; year: number; users: number; vendors: number }> = [];
  const monthlyRevenueData: Array<{ month: string; year: number; value: number; gmv: number }> = [];

  for (let m = 0; m < 12; m++) {
    const key = `${currentYear}-${String(m + 1).padStart(2, "0")}`;
    const monthLabel = monthNames[m];

    platformGrowth.push({
      month: monthLabel,
      year: currentYear,
      users: userGrowthMap.get(key) || 0,
      vendors: vendorGrowthMap.get(key) || 0,
    });

    const rev = monthlyRevenueMap.get(key) || { platformFee: 0, gmv: 0 };
    monthlyRevenueData.push({
      month: monthLabel,
      year: currentYear,
      value: rev.platformFee,
      gmv: rev.gmv,
    });
  }

  return {
    users: {
      total: totalUsers,
      approvedVendors: totalVendors,
      approvedRiders: totalRiders,
      suspendedUsers,
    },
    orders: {
      total: ordersCount,
      completed,
      inTransit,
      pending,
      inProgress,
      cancelled,
      reported,
      // Cancelled orders are excluded from every money figure
      totalGmv: subOrderMoney.gmv + orderStats.totalPlatformFees,
      totalPlatformFees: orderStats.totalPlatformFees,
      totalCommission: subOrderMoney.commission,
      // What the platform earned: platform fees + commission on paid-out sub-orders
      totalRevenue: orderStats.totalPlatformFees + subOrderMoney.commission,
    },
    finance: {
      pendingWithdrawalsCount: withdrawalStats.count,
      pendingWithdrawalsAmount: withdrawalStats.totalAmount,
    },
    operations: {
      openTickets,
      criticalTickets,
      pendingReports,
      pendingVendorApprovals,
      pendingRiderApprovals,
      paymentIssues: withdrawalStats.count,
    },
    charts: {
      weeklyRevenue: weeklyRevenueData,
      monthlyRevenue: monthlyRevenueData,
      platformGrowth,
    },
  };
};

export const AdminDashboardServices = {
  getPlatformOverview,
};
