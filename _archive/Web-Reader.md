> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 网页阅读

> 读取并解析指定 `URL` 的网页内容，可选择返回格式、支持控制缓存、图片保留与摘要选项等。点击 **Try it** 按钮可快速试用。



## OpenAPI

````yaml /openapi/openapi.json post /paas/v4/reader
openapi: 3.0.1
info:
  title: ZHIPU AI API
  description: ZHIPU AI 接口提供强大的 AI 能力，包括聊天对话、工具调用和视频生成。
  license:
    name: ZHIPU AI 开发者协议和政策
    url: https://chat.z.ai/legal-agreement/terms-of-service
  version: 1.0.0
  contact:
    name: Z.AI 开发者
    url: https://chat.z.ai/legal-agreement/privacy-policy
    email: user_feedback@z.ai
servers:
  - url: https://open.bigmodel.cn/api/
    description: 开放平台服务
security:
  - bearerAuth: []
tags:
  - name: 模型 API
    description: Chat API
  - name: 工具 API
    description: Web Search API
  - name: Agent API
    description: Agent API
  - name: 文件 API
    description: File API
  - name: 知识库 API
    description: Knowledge API
  - name: 实时 API
    description: Realtime API
  - name: 批处理 API
    description: Batch API
  - name: 助理 API
    description: Assistant API
  - name: 智能体 API（旧）
    description: QingLiu Agent API
paths:
  /paas/v4/reader:
    post:
      tags:
        - 工具 API
      summary: 网页阅读
      description: 读取并解析指定 `URL` 的网页内容，可选择返回格式、支持控制缓存、图片保留与摘要选项等。点击 **Try it** 按钮可快速试用。
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ReaderRequest'
            examples:
              Basic:
                value:
                  url: https://www.example.com
        required: true
      responses:
        '200':
          description: 业务处理成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ReaderResponse'
        default:
          description: 请求失败。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
    ReaderRequest:
      type: object
      properties:
        url:
          type: string
          description: 需要抓取的`url`
        timeout:
          type: integer
          description: 请求超时时间（秒），默认值 `20`
          default: 20
        no_cache:
          type: boolean
          description: 是否禁用缓存（`true`/`false`），默认值 `false`
          default: false
        return_format:
          type: string
          description: 返回格式（如：`markdown`、`text`等），默认值 `markdown`
          default: markdown
        retain_images:
          type: boolean
          description: 是否保留图片（`true`/`false`），默认值 `true`
          default: true
        no_gfm:
          type: boolean
          description: 是否禁用 `GitHub Flavored Markdown`（`true`/`false`），默认值 `false`
          default: false
        keep_img_data_url:
          type: boolean
          description: 是否保留图片数据 `URL`（`true`/`false`），默认值 `false`
          default: false
        with_images_summary:
          type: boolean
          description: 是否包含图片摘要（`true`/`false`），默认值 `false`
          default: false
        with_links_summary:
          type: boolean
          description: 是否包含链接摘要（`true`/`false`），默认值 `false`
          default: false
      required:
        - url
    ReaderResponse:
      type: object
      properties:
        id:
          description: 任务 `ID`
          type: string
        created:
          type: integer
          format: int64
          description: 请求创建时间，是以秒为单位的 `Unix` 时间戳
        request_id:
          type: string
          description: 由用户端传递，需要唯一；用于区分每次请求的唯一标识符。如果用户端未提供，平台将默认生成。
        model:
          type: string
          description: 模型编码
        reader_result:
          type: object
          description: 网页阅读结果
          properties:
            content:
              type: string
              description: 网页解析后的主要内容（正文、图片、链接等标记）
            description:
              type: string
              description: 网页简要描述
            title:
              type: string
              description: 网页标题
            url:
              type: string
              description: 网页原始地址
            external:
              type: object
              description: 网页引用的外部资源对象
              properties:
                stylesheet:
                  type: object
                  description: 外部样式表集合
                  additionalProperties:
                    type: object
                    properties:
                      type:
                        type: string
                        description: 样式表类型，通常为`text/css`
            metadata:
              type: object
              description: 页面元数据信息
              properties:
                keywords:
                  type: string
                  description: 页面关键词
                viewport:
                  type: string
                  description: 页面视口设置
                description:
                  type: string
                  description: 元数据描述
                format-detection:
                  type: string
                  description: 格式检测设置，如`telephone=no`
    Error:
      type: object
      properties:
        error:
          required:
            - code
            - message
          type: object
          properties:
            code:
              type: string
            message:
              type: string
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        标准的 HTTP Bearer 认证方式，在 [API
        Keys](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) 页面获取密钥。

````

```javascript
const options = {
  method: 'POST',
  headers: {Authorization: 'Bearer <token>', 'Content-Type': 'application/json'},
  body: JSON.stringify({url: 'https://www.example.com'})
};

fetch('https://open.bigmodel.cn/api/paas/v4/reader', options)
  .then(res => res.json())
  .then(res => console.log(res))
  .catch(err => console.error(err));
```

```json
// 正常响应
{
  "id": "<string>",
  "created": 123,
  "request_id": "<string>",
  "model": "<string>",
  "reader_result": {
    "content": "<string>",
    "description": "<string>",
    "title": "<string>",
    "url": "<string>",
    "external": {
      "stylesheet": {}
    },
    "metadata": {
      "keywords": "<string>",
      "viewport": "<string>",
      "description": "<string>",
      "format-detection": "<string>"
    }
  }
}
```

```json
// defalut
{
  "error": {
    "code": "<string>",
    "message": "<string>"
  }
}
```

