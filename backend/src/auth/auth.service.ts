import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { listQcProjects, userMayUseQcProject } from '../qc/qc-project-context';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { LdapService } from './ldap.service';
import * as bcrypt from 'bcrypt';

// These accounts always authenticate locally regardless of LDAP setting
const LOCAL_AUTH_EMAILS = [
  'nissim@test.com', 'nisim@dev.com', 'hay@dev.com', 'Hay@dev.com',
  'Kobi@test.com',
  'qa-admin@test.com', 'qa-manager@test.com',
  'reg-admin@test.com', 'reg-manager@test.com',
];

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private ldapService: LdapService,
  ) {}

  // The QC project this session works on (chosen at login, 2026-10-09):
  // none chosen = the default project; a project the user may not use is
  // refused with its display name. It rides in the JWT as `qcProject`.
  private async resolveQcProject(user: { id: string; role: string }, requested?: string): Promise<{ key: string; displayName: string } | null> {
    const rows = await listQcProjects(true);
    const project = requested ? rows.find(r => r.key === requested) : rows.find(r => r.isDefault);
    if (!project) {
      if (requested) throw new ForbiddenException('הפרויקט שנבחר אינו קיים');
      return null;
    }
    if (!(await userMayUseQcProject(user, project))) {
      throw new ForbiddenException(`אין לך הרשאה לפרויקט ${project.displayName}`);
    }
    return { key: project.key, displayName: project.displayName };
  }

  private async issueToken(user: { id: string; role: string; email: string; fullName?: string | null }, requestedProject?: string) {
    const qcProject = await this.resolveQcProject(user, requestedProject);
    const token = this.jwtService.sign({ sub: user.id, role: user.role, email: user.email, qcProject: qcProject?.key ?? null });
    return { token, user: { id: user.id, email: user.email, role: user.role, fullName: user.fullName }, qcProject };
  }

  async login(email: string, password: string, qcProject?: string) {
    const invalid = () => new UnauthorizedException('Invalid credentials');
    const isLocalAccount = LOCAL_AUTH_EMAILS.includes(email.toLowerCase());

    if (!isLocalAccount) {
      const ldapEnabled = await this.ldapService.isEnabled().catch(() => false);
      if (ldapEnabled) {
        const ldapUser = await this.ldapService.authenticate(email, password);
        if (!ldapUser) throw invalid();

        const user = await this.usersService.findByEmail(ldapUser.email);
        if (!user || !user.active) throw invalid();

        return this.issueToken(user, qcProject);
      }
    }

    // Local bcrypt auth — used for LOCAL_AUTH_EMAILS and when LDAP is disabled
    const user = await this.usersService.findByEmail(email);
    if (!user) throw invalid();
    if (!user.active) throw invalid();
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw invalid();

    return this.issueToken(user, qcProject);
  }

  async validateUser(id: string) {
    return this.usersService.findById(id);
  }
}
