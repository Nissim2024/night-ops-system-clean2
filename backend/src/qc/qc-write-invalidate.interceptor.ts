import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { invalidateQcReadCache } from './qc-cache';

// Any successful write through the QC API (POST / PUT / PATCH / DELETE: status,
// comment, new defect, attachment, field edit…) drops the short-lived QC read
// cache, so the writer sees the change on the very next load (qc-cache.ts).
@Injectable()
export class QcWriteInvalidateInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const method = ctx.switchToHttp().getRequest()?.method ?? 'GET';
    if (method === 'GET' || method === 'HEAD') return next.handle();
    return next.handle().pipe(tap(() => invalidateQcReadCache()));
  }
}
