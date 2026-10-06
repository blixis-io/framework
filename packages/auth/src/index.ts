export { AuthConfigError, defineAuthModule, Public, Roles, type AuthModuleOptions, type IssuingOptions } from "./module.js";
export {
  type AuthService,
  type CredentialStore,
  type NewRefreshToken,
  type RefreshTokenRecord,
  type RefreshTokenStore,
  type TokenPair,
} from "./issuing.js";
export { hashPassword, verifyPassword } from "./password.js";
