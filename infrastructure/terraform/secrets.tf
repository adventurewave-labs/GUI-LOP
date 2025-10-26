# JWT Secret
resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name = "${local.name_prefix}/jwt/secret"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt_secret.result
}

# Application Secrets
resource "aws_secretsmanager_secret" "app_secrets" {
  name = "${local.name_prefix}/application/secrets"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    JWT_SECRET           = random_password.jwt_secret.result
    SESSION_SECRET       = random_password.session_secret.result
    COOKIE_SECRET        = random_password.cookie_secret.result
    API_KEYS             = jsonencode({
      STRIPE             = "sk_test_placeholder"
      SENDGRID           = "SG.placeholder"
      SENTRY_DSN         = "https://placeholder@sentry.io/123456"
    })
  })
}

# Session Secret
resource "random_password" "session_secret" {
  length  = 64
  special = false
}

# Cookie Secret
resource "random_password" "cookie_secret" {
  length  = 64
  special = false
}

# GitHub OAuth Secret
resource "aws_secretsmanager_secret" "github_oauth" {
  name = "${local.name_prefix}/oauth/github"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "github_oauth" {
  secret_id = aws_secretsmanager_secret.github_oauth.id
  secret_string = jsonencode({
    CLIENT_ID     = "placeholder_github_client_id"
    CLIENT_SECRET = "placeholder_github_client_secret"
  })
}

# Google OAuth Secret
resource "aws_secretsmanager_secret" "google_oauth" {
  name = "${local.name_prefix}/oauth/google"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "google_oauth" {
  secret_id = aws_secretsmanager_secret.google_oauth.id
  secret_string = jsonencode({
    CLIENT_ID     = "placeholder_google_client_id"
    CLIENT_SECRET = "placeholder_google_client_secret"
  })
}