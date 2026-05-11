import { ConflictError } from '../../../../shared-kernel/domain/errors.js';
import { EmailAddress } from '../../domain/user/email-address.js';
import { Username } from '../../domain/user/username.js';
import { RoleName } from '../../domain/user/role-name.js';
import { User } from '../../domain/user/user.js';

/**
 * RegisterUser use case.
 */
export class RegisterUserUseCase {
  constructor({ userRepository, passwordHasher, outbox, idGenerator, clock }) {
    this.userRepository = userRepository;
    this.passwordHasher = passwordHasher;
    this.outbox = outbox;
    this.idGenerator = idGenerator;
    this.clock = clock;
  }

  /**
   * @param {{ email: string, username: string, password: string, role?: string, fullName?: string }} cmd
   */
  async execute(cmd) {
    const email = new EmailAddress(cmd.email);
    const username = new Username(cmd.username);
    const role = cmd.role ? new RoleName(cmd.role) : RoleName.user();

    if (typeof cmd.password !== 'string' || cmd.password.length < 8) {
      const err = new Error('password must be at least 8 characters');
      err.code = 'VALIDATION';
      err.field = 'password';
      throw err;
    }

    const [byEmail, byUsername] = await Promise.all([
      this.userRepository.findByEmail(email),
      this.userRepository.findByUsername(username),
    ]);
    if (byEmail) throw new ConflictError('Email already registered');
    if (byUsername) throw new ConflictError('Username already taken');

    const passwordHash = await this.passwordHasher.hash(cmd.password);

    const user = User.register({
      id: this.idGenerator.newId(),
      email,
      username,
      passwordHash,
      role,
      fullName: cmd.fullName ?? null,
      now: this.clock.now(),
    });

    await this.userRepository.save(user);
    await this.outbox.enqueue(user.pullEvents());

    return {
      id: user.id,
      email: user.email.value,
      username: user.username.value,
      role: user.role.value,
    };
  }
}
