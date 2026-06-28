type JsonResponse = {
  status: (code: number) => {
    json: (body: Record<string, string>) => void
  }
}

export default function handler(_req: unknown, res: JsonResponse) {
  res.status(503).json({
    error: 'Backend is not configured for this Vercel frontend deployment.',
  })
}
