if (!process.env.SKIN_DATABASE_URL) {
  console.error(
    '缺少 SKIN_DATABASE_URL。迁移命令需要真实数据库连接串，' +
      '格式：postgresql://user:password@host:5432/dbname（值不会写入日志）。',
  );
  process.exit(1);
}
