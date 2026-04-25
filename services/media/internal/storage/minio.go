package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Client struct {
	mc             *minio.Client
	bucket         string
	publicEndpoint string
}

type Options struct {
	Endpoint       string
	AccessKey      string
	SecretKey      string
	UseSSL         bool
	Bucket         string
	PublicEndpoint string
}

func New(ctx context.Context, opt Options) (*Client, error) {
	mc, err := minio.New(opt.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(opt.AccessKey, opt.SecretKey, ""),
		Secure: opt.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("minio client: %w", err)
	}
	c := &Client{mc: mc, bucket: opt.Bucket, publicEndpoint: strings.TrimRight(opt.PublicEndpoint, "/")}
	if err := c.ensureBucket(ctx); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *Client) ensureBucket(ctx context.Context) error {
	exists, err := c.mc.BucketExists(ctx, c.bucket)
	if err != nil {
		return fmt.Errorf("bucket exists: %w", err)
	}
	if exists {
		return nil
	}
	if err := c.mc.MakeBucket(ctx, c.bucket, minio.MakeBucketOptions{}); err != nil {
		return fmt.Errorf("make bucket: %w", err)
	}
	return nil
}

func (c *Client) Bucket() string { return c.bucket }

func (c *Client) Ready(ctx context.Context) error {
	exists, err := c.mc.BucketExists(ctx, c.bucket)
	if err != nil {
		return fmt.Errorf("bucket check: %w", err)
	}
	if !exists {
		return fmt.Errorf("bucket %q missing", c.bucket)
	}
	return nil
}

func (c *Client) PutObject(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	_, err := c.mc.PutObject(ctx, c.bucket, key, r, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return fmt.Errorf("put object: %w", err)
	}
	return nil
}

func (c *Client) GetObject(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
	obj, err := c.mc.GetObject(ctx, c.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, 0, "", fmt.Errorf("get object: %w", err)
	}
	info, err := obj.Stat()
	if err != nil {
		obj.Close()
		return nil, 0, "", fmt.Errorf("stat object: %w", err)
	}
	return obj, info.Size, info.ContentType, nil
}

func (c *Client) RemoveObject(ctx context.Context, key string) error {
	return c.mc.RemoveObject(ctx, c.bucket, key, minio.RemoveObjectOptions{})
}

func (c *Client) PresignGet(ctx context.Context, key, filename string, ttl time.Duration) (string, error) {
	params := url.Values{}
	if filename != "" {
		params.Set("response-content-disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	}
	u, err := c.mc.PresignedGetObject(ctx, c.bucket, key, ttl, params)
	if err != nil {
		return "", fmt.Errorf("presign: %w", err)
	}
	if c.publicEndpoint != "" {
		u.Host = hostFromPublic(c.publicEndpoint)
		u.Scheme = schemeFromPublic(c.publicEndpoint)
	}
	return u.String(), nil
}

func hostFromPublic(p string) string {
	if i := strings.Index(p, "://"); i >= 0 {
		return p[i+3:]
	}
	return p
}

func schemeFromPublic(p string) string {
	if strings.HasPrefix(p, "https://") {
		return "https"
	}
	return "http"
}
