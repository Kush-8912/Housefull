import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const ROLES = ['attendee', 'organizer'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Accounts made with "Continue with Google" have no password.
    passwordHash: { type: String, required() { return !this.googleId; }, select: false },
    hasPassword: { type: Boolean, default: true },
    // Google's stable account ID ("sub"), once the account has signed in with Google.
    googleId: { type: String, unique: true, sparse: true, select: false },
    role: { type: String, enum: ROLES, default: 'attendee' },
    // Login tokens issued before this are rejected, so changing the password
    // signs out every other device.
    passwordChangedAt: { type: Date, default: null, select: false },
    // Organizers verify their identity (PAN, via kycService) before they can
    // publish. Only the PAN's last 4 characters are kept.
    hostVerification: {
      type: new mongoose.Schema({ legalName: String, holderType: String, panLast4: String, verifiedAt: Date }, { _id: false }),
      default: null,
    },
    // Set when a profile photo is uploaded; doubles as the photo's cache-busting version.
    avatarUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.methods.verifyPassword = async function verifyPassword(plain) {
  return Boolean(this.passwordHash) && bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, 12);

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.passwordChangedAt;
    delete ret.googleId;
    if ('hostVerification' in ret) ret.verifiedHost = Boolean(ret.hostVerification?.verifiedAt);
    ret.avatarUrl = avatarUrlFor(ret);
    delete ret.avatarUpdatedAt;
    delete ret.__v;
    return ret;
  },
});

// Versioned so browsers can cache a photo forever and still see a new one.
export const avatarUrlFor = (user) => (user?.avatarUpdatedAt ? `/api/users/${user._id}/avatar?v=${new Date(user.avatarUpdatedAt).getTime()}` : null);

export const User = mongoose.model('User', userSchema);
