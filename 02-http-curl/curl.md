# 2. POST con cURL

```bash
curl 'https://httpbin.org/post?type=authorization' \
    -H 'Accept: */*' \
    -H 'Cache-Control: no-cache' \
    -H 'Connection: close' \
    -H 'Content-Type: application/json' \
    --data-raw '{
        "client_id": "1234",
        "mail": "1@1.com",
        "country": "AR"
    }'
```