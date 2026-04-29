# Provider Console

Dashboard for Privacy Provider operators to manage, monitor, and configure their
provider instance(s) on the Moonlight Protocol.

## Live

https://provider-console.fly.storage.tigris.dev/index.html

## Development

```bash
deno task dev      # dev server with watch
deno task build    # build to public/
deno task serve    # serve built files
```

## Production Build

```bash
deno task build -- --production   # minified, no sourcemaps
```

## Deployment

Static files are deployed to a public [Tigris](https://www.tigrisdata.com/)
bucket on Fly.io.

- **Bucket**: `provider-console`
- **URL**: https://provider-console.fly.storage.tigris.dev/index.html
- **Auto-deploy**: push to `main` triggers the GitHub Actions workflow
  (`.github/workflows/deploy.yml`)
- **Secrets** (set in GitHub repo settings): `TIGRIS_ACCESS_KEY_ID`,
  `TIGRIS_SECRET_ACCESS_KEY`

### Manual deploy

```bash
deno task build -- --production

aws s3 sync public/ s3://provider-console/ \
  --endpoint-url https://fly.storage.tigris.dev \
  --acl public-read \
  --delete
```

Requires AWS CLI and Tigris credentials as `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` env vars.
