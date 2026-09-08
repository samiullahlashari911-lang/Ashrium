<?php
/**
 * Plugin Name: Ashrium Virtual Fitting Room
 * Description: WooCommerce twin of the Shopify VFR embed. Mints a short-lived widget token and maps a high-confidence size onto the selected variation.
 * Version: 1.0.0
 * Requires at least: 6.4
 * Requires PHP: 8.1
 * Requires Plugins: woocommerce
 */

if (!defined('ABSPATH')) {
    exit;
}

function ashrium_vfr_platform_url()
{
    $stored = trim((string) get_option('ashrium_vfr_platform_url', ''));
    if ($stored !== '') {
        return untrailingslashit($stored);
    }

    return '';
}

function ashrium_vfr_register_settings()
{
    register_setting('ashrium_vfr', 'ashrium_vfr_platform_url', [
        'type' => 'string',
        'sanitize_callback' => 'esc_url_raw',
        'default' => '',
    ]);
}
add_action('admin_init', 'ashrium_vfr_register_settings');

function ashrium_vfr_admin_menu()
{
    add_options_page(
        'Ashrium VFR',
        'Ashrium VFR',
        'manage_options',
        'ashrium-vfr',
        'ashrium_vfr_render_settings'
    );
}
add_action('admin_menu', 'ashrium_vfr_admin_menu');

function ashrium_vfr_render_settings()
{
    if (!current_user_can('manage_options')) {
        return;
    }
    ?>
    <div class="wrap">
        <h1>Ashrium Virtual Fitting Room</h1>
        <form action="options.php" method="post">
            <?php settings_fields('ashrium_vfr'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row">
                        <label for="ashrium_vfr_platform_url">Ashrium platform URL</label>
                    </th>
                    <td>
                        <input
                            name="ashrium_vfr_platform_url"
                            id="ashrium_vfr_platform_url"
                            type="url"
                            class="regular-text"
                            value="<?php echo esc_attr(ashrium_vfr_platform_url()); ?>"
                            placeholder="https://app.ashrium.example"
                        />
                        <p class="description">
                            Origin of your Ashrium deployment. The storefront origin must be on that tenant&rsquo;s allowlist.
                        </p>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

/**
 * Shortcode [ashrium_vfr] and automatic mount under Add to cart on product pages.
 */
function ashrium_vfr_render_embed()
{
    if (!function_exists('wc_get_product')) {
        return '';
    }

    $product = wc_get_product(get_the_ID());
    if (!$product) {
        return '';
    }

    $platform_url = ashrium_vfr_platform_url();
    if ($platform_url === '') {
        return '';
    }

    $sku = (string) $product->get_sku();
    if ($sku === '' && $product->is_type('variable')) {
        foreach ($product->get_available_variations() as $variation) {
            if (!empty($variation['sku'])) {
                $sku = (string) $variation['sku'];
                break;
            }
        }
    }

    $mount_id = 'ashrium-vfr-' . (string) $product->get_id();
    $variations = [];
    if ($product->is_type('variable')) {
        foreach ($product->get_available_variations() as $variation) {
            $variations[] = [
                'variation_id' => (int) $variation['variation_id'],
                'sku' => (string) ($variation['sku'] ?? ''),
                'attributes' => $variation['attributes'] ?? [],
            ];
        }
    }

    ob_start();
    ?>
    <div
        id="<?php echo esc_attr($mount_id); ?>"
        class="ashrium-vfr-mount"
        data-sku="<?php echo esc_attr($sku); ?>"
    ></div>
    <script>
    (function () {
      var mount = document.getElementById(<?php echo wp_json_encode($mount_id); ?>);
      var appOrigin = <?php echo wp_json_encode($platform_url); ?>;
      var variants = <?php echo wp_json_encode($variations); ?>;

      if (!mount || !appOrigin) return;
      try {
        appOrigin = new URL(appOrigin).origin;
      } catch (error) {
        return;
      }

      function normalizeSize(value) {
        return String(value || '').trim().toLowerCase();
      }

      function selectNativeVariant(size) {
        var normalizedSize = normalizeSize(size);
        var match = variants.find(function (variant) {
          var attributes = variant.attributes || {};
          return Object.keys(attributes).some(function (key) {
            return normalizeSize(attributes[key]) === normalizedSize;
          });
        });

        if (!match) return;

        var form = document.querySelector('form.variations_form');
        if (!form) return;

        Object.keys(match.attributes || {}).forEach(function (attributeName) {
          var field = form.querySelector('[name="' + attributeName + '"]');
          if (!field) return;
          field.value = match.attributes[attributeName];
          field.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }

      window.addEventListener('message', function (event) {
        if (event.origin !== appOrigin || !event.data || event.data.source !== 'ashrium-vfr') return;
        if (event.data.type === 'VFR_SIZE_RECOMMENDED' && event.data.payload) {
          selectNativeVariant(event.data.payload.size);
        }
      });

      fetch(appOrigin + '/api/v1/widget/token', {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'text/plain' },
        body: '{}'
      })
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .then(function (payload) {
          if (!payload || typeof payload.token !== 'string') return;

          var script = document.createElement('script');
          script.src = appOrigin + '/vfr-widget.js?v=no-sandbox-1';
          script.async = true;
          script.dataset.embedToken = payload.token;
          script.dataset.sku = mount.dataset.sku || '';
          mount.appendChild(script);
        })
        .catch(function () {
          console.error('[Ashrium VFR] Widget authorization failed.');
        });
    })();
    </script>
    <?php
    return (string) ob_get_clean();
}

add_shortcode('ashrium_vfr', 'ashrium_vfr_render_embed');
add_action('woocommerce_after_add_to_cart_button', static function () {
    echo ashrium_vfr_render_embed();
});
