import { PartialType } from '@nestjs/mapped-types';
import { CreateWaitListDto } from './create-wait-list.dto';

export class UpdateWaitListDto extends PartialType(CreateWaitListDto) {}
