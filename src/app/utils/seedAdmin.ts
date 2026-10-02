import bcrypt from "bcrypt";
import { configs } from "../config/index";
import { AuthIdentity } from "../modules/auth_identity/auth_identity.model";
import { UserRole } from "../modules/user/user.interface";
import { User } from "../modules/user/user.model";
import { logger } from "./logger";

export const seedAdmin = async () => {
  try {
    const exists = await User.findOne({ email: configs.admin_email });
    if (exists) {
      logger.info("Admin already exists");
      return;
    }

    logger.info("Creating Admin...");

    const hashedPassword = await bcrypt.hash(
      configs.admin_password,
      Number(configs.bcrypt_salt_round),
    );

    const admin = await User.create({
      name: "Admin",
      roles: [UserRole.admin],
      email: configs.admin_email,
      password: hashedPassword,
      isEmailVerified: true,
    });

    await AuthIdentity.create({
      userId: admin._id,
      provider: "local",
      providerId: configs.admin_email,
    });

    logger.info("Admin created successfully.");
  } catch (error) {
    logger.error("Failed to seed admin", { error });
  }
};
