import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { createUser, findUserByEmail, findUserById } from '../db/usersRepository';
import {
  findActiveRefreshToken,
  revokeAllRefreshTokensForUser,
  storeRefreshToken,
} from '../db/refreshTokensRepository';
import { extractBearerToken, MissingOrInvalidAuthHeaderError } from '../utils/authHeader';
import { ConflictError, UnauthorizedError } from '../utils/httpErrors';
import {
  accessTokenExpiresInSeconds,
  generateRefreshToken,
  refreshTokenExpiryDate,
  signAccessToken,
  verifyAccessToken,
} from '../utils/tokens';

const BCRYPT_COST = 12;

const registerSchema = {
  body: {
    type: 'object',
    required: ['email', 'password', 'name'],
    properties: {
      email: { type: 'string', format: 'email', minLength: 3, maxLength: 254 },
      password: { type: 'string', minLength: 8, maxLength: 256 },
      name: { type: 'string', minLength: 1, maxLength: 256 },
    },
    additionalProperties: false,
  },
} as const;

const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', minLength: 1, maxLength: 254 },
      password: { type: 'string', minLength: 1, maxLength: 256 },
    },
    additionalProperties: false,
  },
} as const;

const refreshSchema = {
  body: {
    type: 'object',
    required: ['refreshToken'],
    properties: {
      refreshToken: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
} as const;

interface RegisterBody {
  email: string;
  password: string;
  name: string;
}

interface LoginBody {
  email: string;
  password: string;
}

interface RefreshBody {
  refreshToken: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RegisterBody }>('/auth/register', { schema: registerSchema }, async (request, reply) => {
    const { email, password, name } = request.body;
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictError('email already registered');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await createUser({ email: normalizedEmail, passwordHash, name: name.trim() });

    request.log.info({ userId: user.id }, 'user registered');
    reply.code(201).send({ userId: user.id });
  });

  app.post<{ Body: LoginBody }>('/auth/login', { schema: loginSchema }, async (request, reply) => {
    const { email, password } = request.body;
    const normalizedEmail = email.trim().toLowerCase();

    const user = await findUserByEmail(normalizedEmail);
    if (!user) {
      // Same error as a bad password so we don't leak which emails are registered.
      throw new UnauthorizedError('invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      throw new UnauthorizedError('invalid email or password');
    }

    const accessToken = signAccessToken({ sub: user.id, email: user.email });
    const refreshToken = generateRefreshToken();
    await storeRefreshToken({ userId: user.id, rawToken: refreshToken, expiresAt: refreshTokenExpiryDate() });

    request.log.info({ userId: user.id }, 'user logged in');
    reply.code(200).send({
      accessToken,
      refreshToken,
      expiresIn: accessTokenExpiresInSeconds(),
    });
  });

  app.post<{ Body: RefreshBody }>('/auth/refresh', { schema: refreshSchema }, async (request, reply) => {
    const { refreshToken } = request.body;

    const tokenRow = await findActiveRefreshToken(refreshToken);
    if (!tokenRow) {
      throw new UnauthorizedError('invalid or expired refresh token');
    }

    const user = await findUserById(tokenRow.user_id);
    if (!user) {
      throw new UnauthorizedError('invalid or expired refresh token');
    }

    const accessToken = signAccessToken({ sub: user.id, email: user.email });
    reply.code(200).send({ accessToken });
  });

  app.get('/auth/me', async (request, reply) => {
    const token = extractBearerTokenOrThrow(request.headers.authorization);
    const payload = verifyAccessTokenOrThrow(token);

    const user = await findUserById(payload.sub);
    if (!user) {
      throw new UnauthorizedError('user no longer exists');
    }

    reply.code(200).send({ userId: user.id, email: user.email, name: user.name });
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = extractBearerTokenOrThrow(request.headers.authorization);
    const payload = verifyAccessTokenOrThrow(token);

    await revokeAllRefreshTokensForUser(payload.sub);

    request.log.info({ userId: payload.sub }, 'user logged out');
    reply.code(204).send();
  });
}

function extractBearerTokenOrThrow(authorizationHeader: string | undefined): string {
  try {
    return extractBearerToken(authorizationHeader);
  } catch (err) {
    if (err instanceof MissingOrInvalidAuthHeaderError) {
      throw new UnauthorizedError(err.message);
    }
    throw err;
  }
}

function verifyAccessTokenOrThrow(token: string) {
  try {
    return verifyAccessToken(token);
  } catch {
    throw new UnauthorizedError('invalid or expired access token');
  }
}
