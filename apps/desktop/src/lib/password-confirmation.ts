export function passwordsMismatch(
  password: string,
  confirmation: string,
): boolean {
  return confirmation.length > 0 && password !== confirmation;
}

export function passwordsConfirmed(
  password: string,
  confirmation: string,
): boolean {
  return password.length > 0 && password === confirmation;
}
