/**
 * Team broadcast resume: a send cut short by a restart carries on, nobody gets it
 * twice (even with two servers resuming at once), and banned or not-approved
 * accounts never get it. Runs on the throwaway kadou24h-test database (setup.ts).
 */
import mongoose, { Types } from "mongoose";
import { NotificationType } from "../app/modules/notification/notification.interface";
import { Notification } from "../app/modules/notification/notification.model";
import { BroadcastAudience, BroadcastStatus, TeamBroadcast } from "../app/modules/notification/team_broadcast.model";
import { TeamBroadcastServices } from "../app/modules/notification/team_broadcast.service";
import { User } from "../app/modules/user/user.model";
import { VendorProfile } from "../app/modules/vendor_profile/vendor_profile.model";

const DB = process.env.DATABASE_URL as string;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A raw user + store (validation is not what is tested here) */
const store = async (approvalStatus: string, status = "active") => {
  const userId = new Types.ObjectId();
  await User.collection.insertOne({ _id: userId, name: `Store ${approvalStatus} ${status}`, roles: ["customer", "vendor"], status, isDeleted: false });
  await VendorProfile.collection.insertOne({ userId, approvalStatus });
  return userId;
};

describe("Team broadcast", () => {
  beforeAll(async () => {
    // Never anything but the throwaway test database
    if (!/\/kadou24h-test$/.test(DB)) throw new Error(`refusing to run on ${DB}`);
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it("resumes a send stopped by a restart, once per person, only to approved accounts", async () => {
    const [a, b, c] = [await store("approved"), await store("approved"), await store("approved")];
    const banned = await store("approved", "banned");
    const pending = await store("pending");

    // Stopped after reaching "a": its lease ran out
    const broadcast = await TeamBroadcast.create({
      title: "Annonce",
      message: "Bonjour",
      audiences: [BroadcastAudience.vendors],
      sentBy: new Types.ObjectId(),
      recipients: 3,
      delivered: 1,
      lockedUntil: new Date(Date.now() - 1000),
    });
    const id = String(broadcast._id);
    await Notification.create({ userId: a, type: NotificationType.team_message, title: { fr: "Annonce", en: "Annonce" }, body: { fr: "Bonjour", en: "Bonjour" }, data: { kind: "team", broadcastId: id } });

    // Two servers starting at once: only one may send
    await Promise.all([TeamBroadcastServices.resumeUnfinished(), TeamBroadcastServices.resumeUnfinished()]);
    let done = await TeamBroadcast.findById(id).lean();
    for (let i = 0; i < 50 && done?.status !== BroadcastStatus.sent; i++) {
      await sleep(100);
      done = await TeamBroadcast.findById(id).lean();
    }

    expect(done?.status).toBe(BroadcastStatus.sent);
    expect(done?.delivered).toBe(3);
    expect(done?.lockedUntil).toBeUndefined();
    const got = (await Notification.find({ "data.broadcastId": id }).lean()).map((n) => String(n.userId)).sort();
    expect(got).toEqual([a, b, c].map(String).sort());
    expect(got).not.toContain(String(banned));
    expect(got).not.toContain(String(pending));
  });

  it("counts people per group, each person once across groups", async () => {
    const counts = await TeamBroadcastServices.getAudienceCounts([BroadcastAudience.vendors, BroadcastAudience.riders]);
    expect(counts).toEqual({ vendors: 3, riders: 0, workers: 0, total: 3 });
  });
});
