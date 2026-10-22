import { ClientSession } from "mongoose";
import { Counter } from "./counter.model";

export type CounterName = "order" | "sub_order" | "withdrawal" | "ticket" | "booking";

const PREFIX: Record<CounterName, string> = {
  order: "AP",
  sub_order: "SO",
  withdrawal: "WD-",
  ticket: "SUP-",
  booking: "BK",
};

/** Atomically increments and returns the next number of a sequence. */
const next = async (name: CounterName, session?: ClientSession) => {
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after", session },
  );
  return counter.seq;
};

/** Human-readable number, e.g. "AP421", "WD-10245", "SUP-204". */
const nextCode = async (name: CounterName, session?: ClientSession) =>
  `${PREFIX[name]}${await next(name, session)}`;

export const CounterServices = {
  next,
  nextCode,
};
