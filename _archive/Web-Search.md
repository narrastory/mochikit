> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 网络搜索

> `Web Search API` 是一个专给大模型用的搜索引擎，在传统搜索引擎网页读取、排序的能力基础上，增强了意图识别能力，返回更适合大模型处理的结果（网页标题、`URL`、摘要、名称、图标等）。支持意图增强检索、结构化输出和多引擎支持。见 [网络搜索服务](/cn/guide/tools/web-search)。点击 **Try it** 按钮可快速试用。



## OpenAPI

````yaml /openapi/openapi.json post /paas/v4/web_search
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
  /paas/v4/web_search:
    post:
      tags:
        - 工具 API
      summary: 网络搜索
      description: >-
        `Web Search API`
        是一个专给大模型用的搜索引擎，在传统搜索引擎网页读取、排序的能力基础上，增强了意图识别能力，返回更适合大模型处理的结果（网页标题、`URL`、摘要、名称、图标等）。支持意图增强检索、结构化输出和多引擎支持。见
        [网络搜索服务](/cn/guide/tools/web-search)。点击 **Try it** 按钮可快速试用。
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/WebSearchRequest'
        required: true
      responses:
        '200':
          description: 业务处理成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/WebSearchResponse'
        default:
          description: >-
            请求失败。可能的错误码：1701-网络搜索并发已达上限，请稍后重试或减少并发请求；1702-系统未找到可用的搜索引擎服务，请检查配置或联系管理员；1703-搜索引擎未返回有效数据，请调整查询条件。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
    WebSearchRequest:
      type: object
      properties:
        search_query:
          type: string
          description: 需要进行搜索的内容，建议搜索 `query` 不超过 `70` 个字符。
          maxLength: 70
        search_engine:
          type: string
          description: |-
            要调用的搜索引擎编码。目前支持：
            `search_std`：智谱基础版搜索引擎
            `search_pro`：智谱高阶版搜索引擎
            `search_pro_sogou`：搜狗
            `search_pro_quark`：夸克搜索
          example: search_std
          enum:
            - search_std
            - search_pro
            - search_pro_sogou
            - search_pro_quark
        search_intent:
          type: boolean
          description: |-
            是否进行搜索意图识别，默认不执行搜索意图识别。
            `true`：执行搜索意图识别，有搜索意图后执行搜索
            `false`：跳过搜索意图识别，直接执行搜索
          default: false
        count:
          type: integer
          description: >-
            返回结果的条数。可填范围：`1-50`，最大单次搜索返回`50`条，默认为`10`。

            支持的搜索引擎：`search_pro_sogou`、`search_std`、`search_pro`

            `search_pro_sogou`: 可选枚举值，10、20、30、40、50。注意同时指定 search_domain_filter
            和 search_recency_filter 时 count 不生效。
          minimum: 1
          maximum: 50
          default: 10
        search_domain_filter:
          type: string
          description: |-
            用于限定搜索结果的范围，仅返回指定白名单域名的内容。
            白名单域名:（如 `www.example.com`）
            支持的搜索引擎：`search_std、search_pro 、search_pro_sogou`
        search_recency_filter:
          type: string
          description: >-
            搜索指定时间范围内的网页。默认为
            `noLimit`。可填值：`oneDay`（一天内）、`oneWeek`（一周内）、`oneMonth`（一个月内）、`oneYear`（一年内）、`noLimit`（不限，默认）。支持的搜索引擎：`search_std、search_pro、search_pro_Sogou、search_pro_quark`
          default: noLimit
          enum:
            - oneDay
            - oneWeek
            - oneMonth
            - oneYear
            - noLimit
        content_size:
          type: string
          description: >-
            控制返回网页内容的长短。`medium`：返回摘要信息，满足大模型的基础推理需求，满足常规问答任务的信息检索需求。`high`：最大化上下文，信息量较大但内容详细，适合需要信息细节的场景。支持的搜索引擎：`search_std、search_pro、search_pro_Sogou、search_pro_quark`
          enum:
            - medium
            - high
        request_id:
          type: string
          description: >-
            请求唯一标识符。由用户端传递，`ID`长度要求：最少`6`个字符，最多`64`个字符，建议使用`UUID`格式确保唯一性，若未提供平台将自动生成。
          minLength: 6
          maxLength: 64
        user_id:
          type: string
          description: >-
            终端用户的唯一`ID`，帮助平台对终端用户的非法活动、生成非法不当信息或其他滥用行为进行干预。`ID`长度要求：至少`6`个字符，最多`128`个字符。
          minLength: 6
          maxLength: 128
      required:
        - search_query
        - search_engine
        - search_intent
    WebSearchResponse:
      type: object
      properties:
        id:
          type: string
          description: 任务 ID
        created:
          type: integer
          description: 请求创建时间，是以秒为单位的 `Unix` 时间戳
        request_id:
          type: string
          description: 请求标识符
        search_intent:
          type: array
          description: 搜索意图结果
          items:
            type: object
            properties:
              query:
                type: string
                description: 原始搜索query
              intent:
                type: string
                description: >-
                  识别的意图类型。`SEARCH_ALL` = 搜索全网，`SEARCH_NONE` =
                  无搜索意图，`SEARCH_ALWAYS` = 强制搜索模式：当`search_intent=false`时返回此值
                enum:
                  - SEARCH_ALL
                  - SEARCH_NONE
                  - SEARCH_ALWAYS
              keywords:
                type: string
                description: 改写后的搜索关键词
        search_result:
          type: array
          description: 搜索结果
          items:
            type: object
            properties:
              title:
                type: string
                description: 标题
              content:
                type: string
                description: 内容摘要
              link:
                type: string
                description: 结果链接
              media:
                type: string
                description: 网站名称
              icon:
                type: string
                description: 网站图标
              refer:
                type: string
                description: 角标序号
              publish_date:
                type: string
                description: 网站发布时间
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

```js
const options = {
  method: 'POST',
  headers: {Authorization: 'Bearer <token>', 'Content-Type': 'application/json'},
  body: JSON.stringify({
    search_query: '<string>',
    search_engine: 'search_std',
    search_intent: false,
    count: 10,
    search_domain_filter: '<string>',
    search_recency_filter: 'noLimit',
    request_id: '<string>',
    user_id: '<string>'
  })
};

fetch('https://open.bigmodel.cn/api/paas/v4/web_search', options)
  .then(res => res.json())
  .then(res => console.log(res))
  .catch(err => console.error(err));
```

```json
// 成功响应
{
  "id": "<string>",
  "created": 123,
  "request_id": "<string>",
  "search_intent": [
    {
      "query": "<string>",
      "keywords": "<string>"
    }
  ],
  "search_result": [
    {
      "title": "<string>",
      "content": "<string>",
      "link": "<string>",
      "media": "<string>",
      "icon": "<string>",
      "refer": "<string>",
      "publish_date": "<string>"
    }
  ]
}
```

```json
// default
{
  "error": {
    "code": "<string>",
    "message": "<string>"
  }
}
```

