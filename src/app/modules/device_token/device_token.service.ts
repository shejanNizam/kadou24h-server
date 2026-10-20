import { IDeviceToken } from "./device_token.interface";
import { DeviceToken } from "./device_token.model";

const upsertToken = async (payload: Partial<IDeviceToken>) => {
  return DeviceToken.findOneAndUpdate(
    { token: payload.token },
    { ...payload, lastActiveAt: new Date() },
    { upsert: true, new: true, runValidators: true },
  );
};

// Only my own device (sign-out on this phone)
const removeToken = async (userId: string, token: string) => {
  return DeviceToken.findOneAndDelete({ token, userId });
};

const getUserTokens = async (userId: string) => {
  return DeviceToken.find({ userId });
};

export const DeviceTokenServices = { upsertToken, removeToken, getUserTokens };
