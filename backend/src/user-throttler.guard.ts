import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Rate limiting that fits ~150 people on one system (2026-10-10). The
// throttler module was configured but its guard never registered, so nothing
// was limited — not even login. Counting by IP would be wrong here: every
// request reaches the API through the frontend's nginx, and users on Citrix /
// a terminal server share one address. So:
//   - a signed-in request counts against its USER (the token's subject);
//   - login counts against IP + the e-mail typed, so one person's wrong
//     password never locks out a colleague on the same address;
//   - anything else against the client IP (trust proxy → the real address).
// The token isn't verified here — JwtGuard rejects a forged one anyway; this
// only picks the bucket.
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const url = String(req.originalUrl ?? req.url ?? '');
    if (/\/auth\/login\b/.test(url)) {
      return `login:${req.ip}:${String(req.body?.email ?? '').trim().toLowerCase()}`;
    }
    const m = /^Bearer\s+[^.]+\.([^.]+)\./.exec(String(req.headers?.authorization ?? ''));
    if (m) {
      try {
        const sub = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))?.sub;
        if (sub) return `user:${sub}`;
      } catch { /* fall through to the IP */ }
    }
    return `ip:${req.ip}`;
  }
}
