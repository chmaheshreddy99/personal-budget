package com.aditya.personalbudget.config;

import com.aditya.personalbudget.security.AuthInterceptor;
import com.aditya.personalbudget.web.ActivityRecorder;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.filter.ShallowEtagHeaderFilter;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;
    private final ActivityRecorder activityRecorder;

    public WebConfig(AuthInterceptor authInterceptor, ActivityRecorder activityRecorder) {
        this.activityRecorder = activityRecorder;
        this.authInterceptor = authInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/auth/login", "/api/auth/register", "/api/auth/link", "/api/meta/**", "/api/public/**");
        // after the authentication, so the user is still known when the change completes
        registry.addInterceptor(activityRecorder)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/auth/login", "/api/auth/register", "/api/auth/link", "/api/meta/**", "/api/events", "/api/public/**");
    }

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addViewController("/").setViewName("forward:/index.html");
    }

    /**
     * The UI is plain ES modules that import each other by relative path, so a version string on
     * index.html would not reach them. Instead every static file is sent with "no-cache": the browser
     * keeps its copy but asks before using it, and gets a cheap 304 when the file is unchanged
     * (ETag, see {@link #staticEtags()}, or Last-Modified). A new deployment is therefore picked up
     * on the next page load.
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .setCacheControl(CacheControl.noCache().cachePrivate());
    }

    /**
     * ETag = hash of the response body, so it changes exactly when the file content changes.
     * Not applied to "/": that request is forwarded to index.html, and a body-buffering filter around a
     * forward loses the page. "/" revalidates by Last-Modified instead.
     */
    @Bean
    public FilterRegistrationBean<ShallowEtagHeaderFilter> staticEtags() {
        FilterRegistrationBean<ShallowEtagHeaderFilter> bean = new FilterRegistrationBean<>(new ShallowEtagHeaderFilter());
        bean.addUrlPatterns("/index.html", "/mobile.html", "/share.html", "/statement.html", "/css/*", "/js/*", "/img/*");
        bean.setName("staticEtags");
        return bean;
    }
}
