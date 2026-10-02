import { model, Schema } from "mongoose";

// One document per sequence: { _id: "order", seq: 421 }
export interface ICounter {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);

export const Counter = model<ICounter>("Counter", counterSchema);
