import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);

    // Deliberately generic message — don't reveal whether email exists or account is deactivated
    const invalid = () => new UnauthorizedException('Invalid credentials');

    if (!user) throw invalid();
    if (!user.active) throw invalid();

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw invalid();

    // fullName is excluded from the token — embed only what auth decisions need
    const token = this.jwtService.sign({ sub: user.id, role: user.role });
    return { token, user: { id: user.id, email: user.email, role: user.role, fullName: user.fullName } };
  }

  async validateUser(id: string) {
    return this.usersService.findById(id);
  }
}
