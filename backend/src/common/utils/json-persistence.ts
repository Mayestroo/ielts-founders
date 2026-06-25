import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const DEFAULT_MAX_JSON_BYTES = 512 * 1024;
const DEFAULT_MAX_DEPTH = 8;

interface JsonValidationOptions {
  label: string;
  maxBytes?: number;
  maxDepth?: number;
  requirePlainObject?: boolean;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertJsonValue = (
  value: unknown,
  label: string,
  depth: number,
  maxDepth: number,
) => {
  if (depth > maxDepth) {
    throw new BadRequestException(`${label} JSON is too deeply nested`);
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new BadRequestException(`${label} contains an invalid number`);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonValue(item, label, depth + 1, maxDepth);
    }
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new BadRequestException(`${label} contains a forbidden key`);
      }
      assertJsonValue(item, label, depth + 1, maxDepth);
    }
    return;
  }

  throw new BadRequestException(`${label} must be JSON-serializable`);
};

export const toValidatedJson = (
  value: unknown,
  options: JsonValidationOptions,
): Prisma.InputJsonValue => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_JSON_BYTES;

  if (options.requirePlainObject && !isPlainObject(value)) {
    throw new BadRequestException(`${options.label} must be an object`);
  }

  assertJsonValue(value, options.label, 0, maxDepth);

  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new BadRequestException(`${options.label} JSON payload is too large`);
  }

  return value as Prisma.InputJsonValue;
};

export const toValidatedJsonObject = (
  value: unknown,
  label: string,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Record<string, unknown> => {
  toValidatedJson(value, {
    label,
    maxBytes,
    requirePlainObject: true,
  });

  return value as Record<string, unknown>;
};
