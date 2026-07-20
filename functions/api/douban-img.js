// Cloudflare Pages Function: /api/douban-img?url=<豆瓣图片 URL>
// 本地/Node 与 Vercel 使用 api/douban-img.js；Cloudflare Pages 只会执行
// functions/ 目录下的函数，因此需要这个 Web Fetch API 版本。

const ALLOWED_IMAGE_HOSTS = ['doubanio.com', 'douban.com'];
const MAX_REDIRECTS = 3;

function isAllowedDoubanImageUrl(value) {
    try {
        const parsedUrl = new URL(value);
        const hostname = parsedUrl.hostname.toLowerCase();

        return parsedUrl.protocol === 'https:' &&
            !parsedUrl.username &&
            !parsedUrl.password &&
            ALLOWED_IMAGE_HOSTS.some(domain =>
                hostname === domain || hostname.endsWith(`.${domain}`)
            );
    } catch {
        return false;
    }
}

function jsonError(message, status) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store'
        }
    });
}

async function fetchDoubanImage(imageUrl) {
    let currentUrl = imageUrl;

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
        if (!isAllowedDoubanImageUrl(currentUrl)) {
            throw new Error('不允许的图片地址');
        }

        const response = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            headers: {
                'Referer': 'https://movie.douban.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            }
        });

        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) throw new Error('图片重定向缺少目标地址');
            currentUrl = new URL(location, currentUrl).toString();
            continue;
        }

        return response;
    }

    throw new Error('图片重定向次数过多');
}

export async function onRequestGet({ request, waitUntil }) {
    const requestUrl = new URL(request.url);
    const imageUrl = requestUrl.searchParams.get('url');

    if (!imageUrl) {
        return jsonError('缺少图片 URL 参数', 400);
    }

    if (!isAllowedDoubanImageUrl(imageUrl)) {
        return jsonError('无效的豆瓣图片 URL', 400);
    }

    try {
        // Pages Functions 运行在 Workers Runtime 中，可使用 Cache API 缓存成功图片。
        // 测试或其他兼容运行时没有 caches 时会自动跳过，不影响代理功能。
        const edgeCache = globalThis.caches?.default;
        const cacheKey = new Request(request.url, { method: 'GET' });
        if (edgeCache) {
            const cachedResponse = await edgeCache.match(cacheKey);
            if (cachedResponse) return cachedResponse;
        }

        const upstreamResponse = await fetchDoubanImage(imageUrl);

        if (!upstreamResponse.ok) {
            return jsonError(`豆瓣图片请求失败: ${upstreamResponse.status}`, 502);
        }

        const contentType = upstreamResponse.headers.get('content-type') || '';
        if (!contentType.toLowerCase().startsWith('image/')) {
            return jsonError('上游返回的不是图片', 502);
        }

        // 直接转发 ReadableStream，不能调用 text()，否则 WebP/JPEG 等二进制会损坏。
        const imageResponse = new Response(upstreamResponse.body, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400',
                'Access-Control-Allow-Origin': '*',
                'X-Content-Type-Options': 'nosniff'
            }
        });

        if (edgeCache && typeof waitUntil === 'function') {
            waitUntil(edgeCache.put(cacheKey, imageResponse.clone()));
        }

        return imageResponse;
    } catch (error) {
        console.error('Cloudflare 豆瓣图片代理失败:', error);
        return jsonError('获取豆瓣图片失败', 502);
    }
}

export function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '86400'
        }
    });
}
