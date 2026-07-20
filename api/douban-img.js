// 豆瓣海报代理。此处理器同时供 Vercel Functions 和本地 Express 使用。

const ALLOWED_IMAGE_HOSTS = ['doubanio.com', 'douban.com'];

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

async function fetchDoubanImage(url) {
    let currentUrl = url;

    // 手动处理有限次数的重定向，并逐次校验目标域名，防止开放代理。
    for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
        if (!isAllowedDoubanImageUrl(currentUrl)) {
            throw new Error('不允许的图片地址');
        }

        const response = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            headers: {
                'Referer': 'https://movie.douban.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
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

export default async function handler(req, res) {
    // 1. 设置允许跨域
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const url = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;

    if (!url) {
        return res.status(400).json({ error: '缺少图片 URL 参数' });
    }

    if (!isAllowedDoubanImageUrl(url)) {
        return res.status(400).json({ error: '无效的豆瓣图片 URL' });
    }

    try {
        // 2. 服务端携带正确 Referer 请求豆瓣图片。
        const response = await fetchDoubanImage(url);

        if (!response.ok) {
            console.error(`豆瓣拒绝了请求: ${response.status} - ${url}`);
            return res.status(response.status).json({ error: '豆瓣防盗链拦截' });
        }

        // 3. 将图片流转换为安全的 Buffer 数据（Vercel 极其喜欢这种方式）
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 4. 获取实际的图片类型（比如 image/jpeg, image/webp）
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        if (!contentType.toLowerCase().startsWith('image/')) {
            return res.status(502).json({ error: '上游返回的不是图片' });
        }
        
        // 5. 设置响应头并输出图片
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400');
        res.status(200).send(buffer);

    } catch (error) {
        console.error('获取图片时发生严重错误:', error);
        res.status(500).json({ error: error.message || '服务器内部错误' });
    }
}
