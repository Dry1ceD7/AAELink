package service

import (
	"github.com/Dry1ceD7/AAELink/services/auth/internal/security"
)

func init() {
	passwordHasher = security.HashPassword
}
