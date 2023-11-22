export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        let path = url.pathname;

        let cache = caches.default;
        const cachedResponse = await cache.match(request.url);
        if (cachedResponse) {
            return cachedResponse;
        }

        let response = await handleRequest(path, env);

        if (!response) {
            return notFound();
        } else {
            // Recreate the response so you can modify the headers
            response = new Response(response.body, response);
        }

        const origin = request.headers.get("Origin");
        if (!env.ORIGIN_WHITELIST || env.ORIGIN_WHITELIST.length === 0 || env.ORIGIN_WHITELIST.includes(origin)) {
            // Set CORS headers
            response.headers.set('Access-Control-Allow-Origin', origin);
        }

        // Append to/Add Vary header so browser will cache response correctly
        response.headers.append('Vary', 'Origin');

        if (!response.headers.has('Cache-Control')) {
            response.headers.set('Cache-Control', `public, max-age=${env.SKIN_TTL}`);
        }

        await cache.put(request.url, response.clone());

        return response;
    },
}

async function notFound() {
    return new Response("Not found", {status: 404});
}

async function handleRequest(path, env) {
    if (path.startsWith("/uuid/")) {
        const user = path.split("/")[2];
        const uuid = isUuid(user) ? user : await getUuid(user, env);
        return new Response(JSON.stringify({
            id: uuid,
            uuid: uuid,
            user: user,
            name: user
        }), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": `"public, max-age=${env.USERNAME_TTL}`
            }
        });
    }
    if (path.startsWith("/profile/")) {
        const user = path.split("/")[2];
        const uuid = isUuid(user) ? user : await getUuid(user, env);
        const profile = await getProfile(uuid, env);
        return new Response(JSON.stringify(profile), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": `"public, max-age=${env.PROFILE_TTL}`
            }
        });
    }

    if (path.startsWith("/skin/")) {
        const textures = await resolveUuidAndGetTextures(path.split("/")[2], env);
        if (!textures.skin) {
            return notFound();
        }
        const response = await fetch(textures.skin);
        // Recreate the response so you can modify the headers
        return new Response(response.body, {
            ...response, headers: {
                "Cache-Control": `"public, max-age=${env.SKIN_TTL}`
            }
        })
    }
    if (path.startsWith("/cape/")) {
        const textures = await resolveUuidAndGetTextures(path.split("/")[2], env);
        if (!textures.cape) {
            return notFound();
        }
        const response = await fetch(textures.cape);
        // Recreate the response so you can modify the headers
        return new Response(response.body, {
            ...response, headers: {
                "Cache-Control": `"public, max-age=${env.SKIN_TTL}`
            }
        })
    }

    return undefined;
}

async function resolveUuidAndGetTextures(user, env) {
    const uuid = isUuid(user) ? user : await getUuid(user, env);
    const profile = await getProfile(uuid, env);
    if (!profile || !profile.properties || profile.properties.length === 0) {
        return {skin: null, cape: null};
    }
    return await getTexturesFromBase64(profile.properties[0].value);
}

function isUuid(uuid) {
    return uuid.length === 32 || uuid.length === 36;
}


async function getProfile(uuid, env) {
    const cached = await env.SKIN_PROXY.get(`profile:${uuid}`);
    if (cached) {
        return JSON.parse(cached);
    }
    const response = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`);
    if (!response.ok || response.status === 204) {
        return undefined;
    }
    const json = await response.json();
    await env.SKIN_PROXY.put(`profile:${uuid}`, JSON.stringify(json), {expirationTtl: env.PROFILE_TTL});
    return json;
}

async function getUuid(username, env) {
    const cached = await env.SKIN_PROXY.get(`username:${username}`);
    if (cached) {
        return cached;
    }
    const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    if (!response.ok || response.status === 204) {
        return undefined;
    }
    const json = await response.json();
    console.log(json);
    const uuid = json.id;
    await env.SKIN_PROXY.put(`username:${username}`, uuid, {expirationTtl: env.USERNAME_TTL});
    return uuid;
}

async function getTexturesFromBase64(base64) {
    const decoded = JSON.parse(atob(base64));

    const textures = {
        skin: null,
        cape: null
    }
    if ('SKIN' in decoded.textures) {
        textures.skin = decoded.textures.SKIN.url;
    }
    if ('CAPE' in decoded.textures) {
        textures.cape = decoded.textures.CAPE.url;
    }
    return textures;
}