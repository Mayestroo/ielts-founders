import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCenterDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsString()
  loginPassword?: string;
}

export class UpdateCenterDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsString()
  loginPassword?: string;
}
