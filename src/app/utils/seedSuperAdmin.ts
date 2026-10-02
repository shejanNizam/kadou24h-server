import bcrypt from "bcrypt";
import { configs } from "../config/index";
import { AuthIdentity } from "../modules/auth_identity/auth_identity.model";
import { UserRole } from "../modules/user/user.interface";
import { User } from "../modules/user/user.model";
import { logger } from "./logger";

export const seedSuperAdmin = async () => {
  try {
    const exists = await User.findOne({ email: configs.super_admin_email });
    if (exists) {
      logger.info("Super Admin already exists");
      return;
    }

    logger.info("Creating Super Admin...");

    const hashedPassword = await bcrypt.hash(
      configs.super_admin_password,
      Number(configs.bcrypt_salt_round),
    );

    const superAdmin = await User.create({
      name: "Super Admin",
      roles: [UserRole.super_admin],
      email: configs.super_admin_email,
      password: hashedPassword,
      isEmailVerified: true,
    });

    await AuthIdentity.create({
      userId: superAdmin._id,
      provider: "local",
      providerId: configs.super_admin_email,
    });

    logger.info("Super Admin created successfully.");
  } catch (error) {
    logger.error("Failed to seed super admin", { error });
  }
};
