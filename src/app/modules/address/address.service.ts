import httpStatus from "http-status";
import { ILatLng } from "../../interfaces/common.types";
import AppError from "../../errorHelpers/AppError";
import { fromGeoPoint, toGeoPoint } from "../../utils/commonSchemas";
import { IUserAddress, MAX_ADDRESSES } from "../user/user.interface";
import { User } from "../user/user.model";

type AddressInput = Partial<Omit<IUserAddress, "location" | "_id">> & { location?: ILatLng };

const loadAddresses = async (userId: string) => {
  const user = await User.findOne({ _id: userId, isDeleted: false }).select("addresses");
  if (!user?.addresses) throw new AppError(httpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND");
  return { user, addresses: user.addresses };
};

// API shape: location as { lat, lng } instead of GeoJSON
const present = (address: { toObject: () => IUserAddress }) => {
  const obj = address.toObject();
  return { ...obj, location: fromGeoPoint(obj.location) };
};

const getMyAddresses = async (userId: string) => {
  const { addresses } = await loadAddresses(userId);
  // Default first
  return [...addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map(present);
};

const createAddress = async (userId: string, payload: AddressInput) => {
  const { user, addresses } = await loadAddresses(userId);

  if (addresses.length >= MAX_ADDRESSES) {
    throw new AppError(httpStatus.BAD_REQUEST, "ADDRESS_LIMIT", { max: MAX_ADDRESSES });
  }

  // The first address is always the default
  const makeDefault = payload.isDefault === true || addresses.length === 0;
  if (makeDefault) addresses.forEach((a) => (a.isDefault = false));

  addresses.push({
    ...payload,
    location: toGeoPoint(payload.location as ILatLng),
    isDefault: makeDefault,
  });
  await user.save();

  return present(addresses[addresses.length - 1]);
};

const updateAddress = async (userId: string, addressId: string, payload: AddressInput) => {
  const { user, addresses } = await loadAddresses(userId);
  const address = addresses.id(addressId);
  if (!address) throw new AppError(httpStatus.NOT_FOUND, "ADDRESS_NOT_FOUND");

  const { location, isDefault, ...rest } = payload;
  address.set(rest);
  if (location) address.location = toGeoPoint(location);
  if (isDefault === true) {
    addresses.forEach((a) => (a.isDefault = String(a._id) === addressId));
  }

  await user.save();
  return present(address);
};

const setDefaultAddress = async (userId: string, addressId: string) =>
  updateAddress(userId, addressId, { isDefault: true });

const deleteAddress = async (userId: string, addressId: string) => {
  const { user, addresses } = await loadAddresses(userId);
  const address = addresses.id(addressId);
  if (!address) throw new AppError(httpStatus.NOT_FOUND, "ADDRESS_NOT_FOUND");
  const wasDefault = address.isDefault;

  address.deleteOne();
  // Keep exactly one default while any address remains
  if (wasDefault && addresses.length > 0) addresses[0].isDefault = true;

  await user.save();
};

export const AddressServices = {
  getMyAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
};
