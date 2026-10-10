import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Regression 2026-10-10: a request missing a required parameter (e.g. no
// ?versionId) reached Prisma, failed its query validation and came back as a
// bare 500 "Internal server error" — 10 routes did that. A Prisma validation
// error is the caller's input, so it is a 400 with a readable message; a
// missing / not-found record (P2025) is a 404. Everything else is untouched.
@Catch(Prisma.PrismaClientValidationError, Prisma.PrismaClientKnownRequestError)
export class PrismaErrorsFilter implements ExceptionFilter {
  private readonly logger = new Logger('PrismaErrors');

  catch(err: Prisma.PrismaClientValidationError | Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    if (err instanceof Prisma.PrismaClientValidationError) {
      // "Argument `versionId` is missing." → name the parameter
      const arg = /Argument `([^`]+)` is missing/.exec(err.message)?.[1];
      this.logger.warn(`400 ${req?.method} ${req?.url}: ${arg ? `missing ${arg}` : 'invalid query input'}`);
      return res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400, error: 'Bad Request',
        message: arg ? `חסר פרמטר: ${arg}` : 'הבקשה אינה תקינה — פרמטר חסר או שגוי',
      });
    }
    if (err.code === 'P2002') {
      return res.status(HttpStatus.CONFLICT).json({ statusCode: 409, error: 'Conflict', message: 'הרשומה כבר קיימת' });
    }
    if (err.code === 'P2025') {
      return res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, error: 'Not Found', message: 'הרשומה לא נמצאה' });
    }
    this.logger.error(`${req?.method} ${req?.url}: Prisma ${err.code}: ${err.message}`);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: 'Internal server error' });
  }
}
