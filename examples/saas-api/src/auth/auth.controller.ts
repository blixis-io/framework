import { type AuthService } from "@blixis-io/auth";
import { Public } from "@blixis-io/auth";
import { Inject } from "@blixis-io/di";
import { Body, Controller, HttpCode, Post, Returns } from "@blixis-io/http";
import { ApiOperation, ApiTags } from "@blixis-io/http";
import { ApiSecurity } from "@blixis-io/openapi";
import { z } from "zod";
import { AccountsService } from "./accounts.service.js";
import { AUTH_SERVICE } from "./auth.js";

const SignUpSchema = z.object({
  email: z.email(),
  password: z.string().min(12).max(200),
  organizationName: z.string().min(1).max(100),
});
const SignInSchema = z.object({ email: z.string(), password: z.string() });
const RefreshSchema = z.object({ refreshToken: z.string().min(1) });

const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessTokenExpiresAt: z.date(),
  refreshTokenExpiresAt: z.date(),
});

/**
 * The routes that must be reachable without a token. `@Public()` is what the guard reads; `@ApiSecurity(false)` is what
 * the generated OpenAPI document says. They are two decorators because they are two different things, and they must be
 * kept in step by hand.
 */
@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly auth: AuthService,
    private readonly accounts: AccountsService,
  ) {}

  @Public()
  @ApiSecurity(false)
  @Post("sign-up")
  @HttpCode(201)
  @Returns(TokenPairSchema)
  @ApiOperation({ summary: "Create an account, its organization and a first space" })
  async signUp(@Body(SignUpSchema) body: z.infer<typeof SignUpSchema>) {
    const userId = await this.accounts.signUp(body.email, body.password, body.organizationName);
    return this.auth.issueTokens(userId);
  }

  @Public()
  @ApiSecurity(false)
  @Post("sign-in")
  @HttpCode(200)
  @Returns(TokenPairSchema)
  @ApiOperation({ summary: "Exchange an email and password for tokens" })
  signIn(@Body(SignInSchema) body: z.infer<typeof SignInSchema>) {
    return this.auth.signIn(body.email.toLowerCase(), body.password);
  }

  @Public()
  @ApiSecurity(false)
  @Post("refresh")
  @HttpCode(200)
  @Returns(TokenPairSchema)
  @ApiOperation({ summary: "Rotate a refresh token for a new pair" })
  refresh(@Body(RefreshSchema) body: z.infer<typeof RefreshSchema>) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @ApiSecurity(false)
  @Post("sign-out")
  @HttpCode(204)
  @ApiOperation({ summary: "Revoke a refresh token" })
  signOut(@Body(RefreshSchema) body: z.infer<typeof RefreshSchema>) {
    return this.auth.signOut(body.refreshToken);
  }
}
