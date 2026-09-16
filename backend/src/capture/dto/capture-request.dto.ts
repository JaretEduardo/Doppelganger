import { IsUrl } from 'class-validator';

export class CaptureRequestDto {
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  url!: string;
}
