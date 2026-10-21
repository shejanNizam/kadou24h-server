import { Schema, model } from "mongoose";
import { fileRefSchema } from "../../utils/commonSchemas";
import {
  CodSettlementMethod,
  CodSettlementStatus,
  ICodSettlement,
} from "./wallet.interface";

const codSettlementSchema = new Schema<ICodSettlement>(
  {
    riderId: {
      type: Schema.Types.ObjectId,
      ref: "RiderProfile",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    method: {
      type: String,
      enum: Object.values(CodSettlementMethod),
      required: true,
    },
    reference: {
      type: String,
      trim: true,
    },
    proofImage: {
      type: fileRefSchema,
    },
    status: {
      type: String,
      enum: Object.values(CodSettlementStatus),
      default: CodSettlementStatus.pending,
      index: true,
    },
    confirmedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    confirmedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 300,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

codSettlementSchema.index({ riderId: 1, status: 1 });

export const CodSettlement = model<ICodSettlement>(
  "cod_settlements",
  codSettlementSchema,
);
