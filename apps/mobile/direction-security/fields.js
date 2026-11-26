import React from 'react';
import { Field } from '../parent/ui';

export const validCode = (value) => /^[0-9]{6}$/.test(value);
export const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
export const validPassword = (value) => Boolean(value.trim()) && [...value].length >= 15 && [...value].length <= 128;

export function EmailField(props) {
  return <Field label="Adresse e-mail de récupération" maxLength={254} keyboardType="email-address"
    autoCapitalize="none" autoComplete="email" {...props} />;
}

export function AuthenticatorField({ onChangeText, ...props }) {
  return <Field label="Code de l’authentificateur" keyboardType="number-pad" autoComplete="one-time-code" maxLength={6}
    onChangeText={(value) => onChangeText(value.replace(/[^0-9]/g, ''))} {...props} />;
}
