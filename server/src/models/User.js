import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const ROLES = ['attendee', 'organizer'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'attendee' },
    // Login tokens issued before this are rejected, so changing the password
    // signs out every other device.
    passwordChangedAt: { type: Date, default: null, select: false },
    // Set when a profile photo is uploaded; doubles as the photo's cache-busting version.
    avatarUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, 12);

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.passwordChangedAt;
    ret.avatarUrl = avatarUrlFor(ret);
    delete ret.avatarUpdatedAt;
    delete ret.__v;
    return ret;
  },
});

// Versioned so browsers can cache a photo forever and still see a new one.
export const avatarUrlFor = (user) => (user?.avatarUpdatedAt ? `/api/users/${user._id}/avatar?v=${new Date(user.avatarUpdatedAt).getTime()}` : null);

export const User = mongoose.model('User', userSchema);
