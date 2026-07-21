import { Injectable, UnauthorizedException } from '@nestjs/common';
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

  async login(email: string, password: string) {
    const invalid = () => new UnauthorizedException('Invalid credentials');
    const isLocalAccount = LOCAL_AUTH_EMAILS.includes(email.toLowerCase());

    if (!isLocalAccount) {
      const ldapEnabled = await this.ldapService.isEnabled().catch(() => false);
      if (ldapEnabled) {
        const ldapUser = await this.ldapService.authenticate(email, password);
        if (!ldapUser) throw invalid();

        const user = await this.usersService.findByEmail(ldapUser.email);
        if (!user || !user.active) throw invalid();

        const token = this.jwtService.sign({ sub: user.id, role: user.role, email: user.email });
        return { token, user: { id: user.id, email: user.email, role: user.role, fullName: user.fullName } };
      }
    }

    // Local bcrypt auth — used for LOCAL_AUTH_EMAILS and when LDAP is disabled
    const user = await this.usersService.findByEmail(email);
    if (!user) throw invalid();
    if (!user.active) throw invalid();
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw invalid();

    const token = this.jwtService.sign({ sub: user.id, role: user.role, email: user.email });
    return { token, user: { id: user.id, email: user.email, role: user.role, fullName: user.fullName } };
  }

  async validateUser(id: string) {
    return this.usersService.findById(id);
  }
}
