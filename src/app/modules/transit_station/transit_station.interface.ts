import { Document } from "mongoose";
import { IGeoPoint } from "../../interfaces/common.types";

// Bus stations used for intercity relay legs and "pickup at the bus station"
export interface ITransitStationInitial {
  name: string;
  city: string;
  region?: string;
  location: IGeoPoint;
  isActive: boolean;
}

export type ITransitStation = ITransitStationInitial & Document;
