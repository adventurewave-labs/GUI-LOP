/**
 * User Model - Secure User Management with JWT Authentication
 * Handles user storage, password hashing, and token management
 */

import bcrypt from 'bcrypt';

export class User {
  constructor({
    id,
    email,
    password,
    firstName,
    lastName,
    role = 'user',
    isActive = true,
    createdAt,
    updatedAt
  }) {
    this.id = id;
    this.email = email;
    this.password = password; // Hashed password
    this.firstName = firstName;
    this.lastName = lastName;
    this.role = role;
    this.isActive = isActive;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  /**
   * Get safe user data (excluding password)
   */
  toJSON() {
    return {
      id: this.id,
      email: this.email,
      firstName: this.firstName,
      lastName: this.lastName,
      role: this.role,
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  /**
   * Verify password against stored hash
   */
  async verifyPassword(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  }

  /**
   * Update password with new hash
   */
  async updatePassword(newPassword) {
    this.password = await bcrypt.hash(newPassword, 12);
    this.updatedAt = new Date().toISOString();
  }
}

export class UserStore {
  constructor() {
    this.users = new Map();
    this.emailToId = new Map();
  }

  /**
   * Create new user with hashed password
   */
  async create(userData) {
    const { email, password, firstName, lastName, role = 'user' } = userData;

    // Validate required fields
    if (!email || !password || !firstName || !lastName) {
      throw new Error('Email, password, firstName, and lastName are required');
    }

    // Check if user already exists
    if (this.emailToId.has(email.toLowerCase())) {
      throw new Error('User with this email already exists');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }

    // Validate password strength
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    // Hash password with high salt rounds
    const hashedPassword = await bcrypt.hash(password, 12);

    const user = new User({
      id: crypto.randomUUID(),
      email: email.toLowerCase(),
      password: hashedPassword,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      role,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    this.users.set(user.id, user);
    this.emailToId.set(user.email, user.id);

    return user.toJSON();
  }

  /**
   * Find user by ID
   */
  findById(id) {
    const user = this.users.get(id);
    return user ? user.toJSON() : null;
  }

  /**
   * Find user by email (returns full user object for password verification)
   */
  findByEmail(email) {
    const userId = this.emailToId.get(email.toLowerCase());
    if (!userId) return null;

    const user = this.users.get(userId);
    return user || null;
  }

  /**
   * Find user by email for authentication (returns User instance)
   */
  findByEmailForAuth(email) {
    const userId = this.emailToId.get(email.toLowerCase());
    if (!userId) return null;

    const user = this.users.get(userId);
    return user || null;
  }

  /**
   * Update user data
   */
  async update(id, updateData) {
    const user = this.users.get(id);
    if (!user) {
      throw new Error('User not found');
    }

    // Handle password update separately
    if (updateData.password) {
      if (updateData.password.length < 8) {
        throw new Error('Password must be at least 8 characters long');
      }
      await user.updatePassword(updateData.password);
      delete updateData.password;
    }

    // Update other fields
    Object.assign(user, updateData);
    user.updatedAt = new Date().toISOString();

    return user.toJSON();
  }

  /**
   * Deactivate user (soft delete)
   */
  deactivate(id) {
    const user = this.users.get(id);
    if (!user) {
      throw new Error('User not found');
    }

    user.isActive = false;
    user.updatedAt = new Date().toISOString();

    return user.toJSON();
  }

  /**
   * Activate user
   */
  activate(id) {
    const user = this.users.get(id);
    if (!user) {
      throw new Error('User not found');
    }

    user.isActive = true;
    user.updatedAt = new Date().toISOString();

    return user.toJSON();
  }

  /**
   * Get all users (for admin purposes)
   */
  findAll() {
    return Array.from(this.users.values()).map(user => user.toJSON());
  }

  /**
   * Check if email exists
   */
  emailExists(email) {
    return this.emailToId.has(email.toLowerCase());
  }
}

// Singleton instance
export const userStore = new UserStore();