import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { resolvePersonNamesDeep } from './qc.service';

// QC person fields (Assigned To, Tester, Detected By, Closed By, ...) come
// out of Oracle as logins. Service logic keeps comparing logins (per-user
// scope, a tester's own defects), so the swap to full names happens here, on
// the way out to the UI - every endpoint of a controller that carries this
// interceptor, instead of a per-endpoint call that kept getting missed (user
// report 2026-10-05: prod 2.10.6 still showed logins in the defects and
// testing modules).
@Injectable()
export class PersonNamesInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(mergeMap(data => from(resolvePersonNamesDeep(data))));
  }
}
