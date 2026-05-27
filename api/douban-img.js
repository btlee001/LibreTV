// /api/douban-img.js - 专门用于代理豆瓣图片的 Serverless Function

import fetch from 'node-fetch';

export default async function handler(req, res) {
    // 1. 设置 CORS 头，允许前端跨域访问
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 2. 获取前端传递过来的原图 URL 参数
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Missing "url" query parameter' });
    }

    try {
        // 3. 发起请求，核心：必须伪装 Referer 和 User-Agent！
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                // 这是破解豆瓣 418 防盗链的最关键所在
                'Referer': 'https://movie.douban.com/', 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        });

        if (!response.ok) {
            console.error(`Douban Image Proxy Error: ${response.status} for ${url}`);
            // 如果豆瓣依然拒绝，返回 404 让前端走 onerror 兜底逻辑
            return res.status(response.status).end();
        }

        // 4. 获取图片的 Content-Type 并设置到响应头中
        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }
        
        // 5. 设置强缓存策略，减轻 Vercel 函数调用压力和豆瓣请求压力（缓存30天）
        res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=86400');

        // 6. 将图片数据流直接管道化返回给前端
        // 将 node-fetch 的 response.body 转换为 Node.js Readable stream 并通过 res 发送
        return response.body.pipe(res);

    } catch (error) {
        console.error('Fetch image error:', error);
        return res.status(500).json({ error: 'Failed to fetch image' });
    }
}