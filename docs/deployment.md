# Deployment Guide - Vercel

## Prerequisites

- GitHub repository connected to Vercel
- Neon PostgreSQL database with the `ayna` schema populated

## Environment Variables

Set these in your Vercel project settings (Settings > Environment Variables):

| Variable | Value | Environment |
|----------|-------|-------------|
| `DATABASE_URL` | `postgresql://user:pass@host/db?sslmode=require` | Production, Preview, Development |
| `DATABASE_SCHEMA` | `AYNA` | Production, Preview, Development |

## Build Configuration

Vercel auto-detects Next.js. Default settings work:

- **Framework Preset:** Next.js
- **Build Command:** `next build`
- **Output Directory:** `.next`
- **Install Command:** `npm install`
- **Node.js Version:** 20.x or 22.x

## Deployment Steps

1. Push code to GitHub
2. Connect repository to Vercel at vercel.com/new
3. Set environment variables
4. Deploy

```bash
# Or use Vercel CLI
npm i -g vercel
vercel --prod
```

## Production Readiness Checklist

- [x] Environment variables configured (DATABASE_URL, DATABASE_SCHEMA)
- [x] SSL enabled for database connections (Neon default)
- [x] No secrets in source code
- [x] Error handling on all API routes
- [x] Input validation on all endpoints
- [x] Responsive design tested
- [x] Build succeeds with zero warnings
- [x] TypeScript strict mode enabled

## Performance Notes

- **Cold Start:** First request after deployment builds the transit graph (~2-5s). Subsequent requests use cached graph.
- **Graph Size:** ~3,444 nodes, ~11,000+ edges (bus routes + walking transfers). Fits easily in serverless function memory.
- **Database Queries:** Uses Neon serverless driver optimized for edge/serverless with HTTP-based queries.
- **Static Assets:** Served via Vercel's global CDN.

## Monitoring

- Vercel provides built-in analytics and logging
- Check function logs for graph build timing and route computation performance
- Monitor Neon dashboard for database query performance

## Scaling Considerations

For future growth:
- **Real-time data:** Add WebSocket support for live bus tracking
- **Caching:** Add Redis (Vercel KV) for graph caching across function instances
- **Edge functions:** Move stop data API to edge for lower latency
- **Database indexes:** Add spatial indexes if query patterns change
