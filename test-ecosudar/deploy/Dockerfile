# PHP 8.2 + Apache (the -apache tag is the mod_php variant, so the api/.htaccess
# php_flag / php_value directives are honoured once AllowOverride All is set).
FROM php:8.2-apache

# DB drivers the app needs: PDO MySQL driver (config/database.php uses PDO) and
# mysqli (used by some helpers). Both speak the MySQL/MariaDB wire protocol.
RUN docker-php-ext-install pdo_mysql mysqli

# mod_rewrite: api/.htaccess routes every request to index.php.
# mod_headers: api/.htaccess sets security headers inside <IfModule mod_headers.c>.
RUN a2enmod rewrite headers

# Point Apache at api/ as the docroot and allow .htaccess overrides.
COPY apache-vhost.conf /etc/apache2/sites-available/000-default.conf

# The application code itself is bind-mounted at runtime (see docker-compose.yml:
#   ../api -> /var/www/html/api), so nothing is COPYed in here.

EXPOSE 80
