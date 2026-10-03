import { Order } from "../order/order.model";
import { ApprovalStatus } from "../profile_common/profile.common";
import { Report } from "../report/report.model";
import { ReportStatus } from "../report/report.interface";
import { RiderProfile } from "../rider_profile/rider_profile.model";
import { SupportTicket } from "../support_ticket/support_ticket.model";
import { TicketStatus, TicketUrgency } from "../support_ticket/support_ticket.interface";
import { UserStatus } from "../user/user.interface";
import { User } from "../user/user.model";
import { VendorProfile } from "../vendor_profile/vendor_profile.model";
import { Withdrawal } from "../wallet/withdrawal.model";
import { WithdrawalStatus } from "../wallet/wallet.interface";

const getPlatformOverview = async () => {
  const [
    totalUsers,
    totalVendors,
    totalRiders,
    suspendedUsers,
    ordersCount,
    ordersAgg,
    pendingWithdrawals,
    openTickets,
    criticalTickets,
    pendingReports,
    pendingVendorApprovals,
    pendingRiderApprovals,
  ] = await Promise.all([
    User.countDocuments({ isDeleted: false }),
    VendorProfile.countDocuments({ approvalStatus: ApprovalStatus.approved }),
    RiderProfile.countDocuments({ approvalStatus: ApprovalStatus.approved }),
    User.countDocuments({ status: UserStatus.suspended }),
    Order.countDocuments(),
    Order.aggregate([
      {
        $group: {
          _id: null,
          totalGmv: { $sum: "$total" },
          totalPlatformFees: { $sum: "$platformFee" },
          completedOrders: {
            $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
          },
          activeDeliveries: {
            $sum: { $cond: [{ $eq: ["$status", "in_delivery"] }, 1, 0] },
          },
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
  ]);

  const orderStats = ordersAgg[0] || {
    totalGmv: 0,
    totalPlatformFees: 0,
    completedOrders: 0,
    activeDeliveries: 0,
  };

  const withdrawalStats = pendingWithdrawals[0] || {
    count: 0,
    totalAmount: 0,
  };

  return {
    users: {
      total: totalUsers,
      approvedVendors: totalVendors,
      approvedRiders: totalRiders,
      suspendedUsers,
    },
    orders: {
      total: ordersCount,
      completed: orderStats.completedOrders,
      inTransit: orderStats.activeDeliveries,
      totalGmv: orderStats.totalGmv,
      totalPlatformFees: orderStats.totalPlatformFees,
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
    },
  };
};

export const AdminDashboardServices = {
  getPlatformOverview,
};
