import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { TeamsService } from './teams.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

@UseGuards(JwtGuard)
@Controller('teams')
export class TeamsController {
  constructor(private teamsService: TeamsService) {}

  @Get()
  findAll() {
    return this.teamsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.teamsService.findOne(id);
  }

  @Post()
  create(@Body() body: { name: string; description?: string }) {
    return this.teamsService.create(body);
  }

  @Post('seed')
  seedDefaultTeams() {
    return this.teamsService.seedDefaultTeams();
  }

  @Post(':id/members')
  addMember(
    @Param('id') teamId: string,
    @Body() body: { userId: string; isLead?: boolean },
  ) {
    return this.teamsService.addMember(teamId, body.userId, body.isLead);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') teamId: string,
    @Param('userId') userId: string,
  ) {
    return this.teamsService.removeMember(teamId, userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; active?: boolean },
  ) {
    return this.teamsService.update(id, body);
  }
}