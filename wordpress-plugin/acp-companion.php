<?php
/**
 * Plugin Name: ACP Companion
 * Description: Enables canonical and metadata hooks for ACP publishing.
 * Version: 1.0.0
 */

// Register post meta for ACP canonical
add_action('init', function () {
    register_post_meta('post', '_acp_canonical', [
        'show_in_rest' => true,
        'single' => true,
        'type' => 'string',
        'auth_callback' => function () {
            return current_user_can('edit_posts');
        }
    ]);
});

// Output canonical override
add_action('wp_head', function () {
    if (is_singular()) {
        global $post;
        $canonical = get_post_meta($post->ID, '_acp_canonical', true);
        if ($canonical) {
            echo '<link rel="canonical" href="' . esc_url($canonical) . '" />';
        }
    }
}, 1);

// REST health check endpoint
add_action('rest_api_init', function () {
    register_rest_route('acp/v1', '/health', [
        'methods' => 'GET',
        'callback' => function () {
            return ['status' => 'ok'];
        },
        'permission_callback' => '__return_true'
    ]);
});
