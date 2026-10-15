// hosting.json 未配置 D1 时绑定不存在；getDb() 在使用前检查。
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
  }
}
