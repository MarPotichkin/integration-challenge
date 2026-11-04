function decodeJwt(token) {
    const parts = token.split(".");

    if (parts.length !== 3 || !parts[0] || !parts[1]) {
        throw new Error("The JWT token doesn't have a valid format")
    }

    function decodePart(part) {
        const decoded = Buffer.from(part, "base64url").toString("utf8")
        return JSON.parse(decoded);
    }

    return {
        header: decodePart(parts[0]),
        payload: decodePart(parts[1])
    };
}

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"

console.log(decodeJwt(token))