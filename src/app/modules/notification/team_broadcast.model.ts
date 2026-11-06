import { model, Schema, Types } from "mongoose";

/** Who a team broadcast goes to: approved vendors, riders (delivery partners and moto-taxi drivers) or workers */
export enum BroadcastAudience {
  vendors = "vendors",
  riders = "riders",
  workers = "workers",
}

export enum BroadcastStatus {
  sending = "sending",
  sent = "sent",
}

export interface ITeamBroadcast {
  _id: Types.ObjectId;
  title: string;
  message: string;
  audiences: BroadcastAudience[];
  sentBy: Types.ObjectId;
  status: BroadcastStatus;
  /** People it goes to (counted when it starts) */
  recipients: number;
  /** In-app notifications created so far */
  delivered: number;
  /** Phones reached by push (users who turned "account alerts" off get none) */
  pushed: number;
  /** While a server is sending it; an expired lease means the send stopped (restart) and can resume */
  lockedUntil?: Date;
  finishedAt?: Date;
  createdAt: Date;
}

const teamBroadcastSchema = new Schema<ITeamBroadcast>(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    audiences: { type: [String], enum: Object.values(BroadcastAudience), required: true },
    sentBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: Object.values(BroadcastStatus), default: BroadcastStatus.sending },
    recipients: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    pushed: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

teamBroadcastSchema.index({ createdAt: -1 });
teamBroadcastSchema.index({ status: 1 });

export const TeamBroadcast = model<ITeamBroadcast>("TeamBroadcast", teamBroadcastSchema);
