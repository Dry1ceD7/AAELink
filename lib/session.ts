import { cookies } from 'next/headers'

export async function readMattermostToken(): Promise<string | null> {
  return (await cookies()).get('MMTOKEN')?.value ?? null
}
